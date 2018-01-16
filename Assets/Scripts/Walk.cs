using System.Collections;
using System.Collections.Generic;
using UnityEngine;

public class Walk : MonoBehaviour {
	public Animator Rooky;
	public Rigidbody2D rigid;

	// Use this for initialization
	void Start () {
		
	}
	
	// Update is called once per frame
	void Update () {
		//Player Jump
		if(Input.GetKeyDown(KeyCode.Space)) {
		
		// Add jump force
			rigid.AddForce (Vector2.up * 9, ForceMode2D.Impulse);

			//Activate Jump animation Trigger
			Rooky.SetTrigger("DidJump");

	}

}
	void OnCollisionEnter2D (Collision2D collision){

		if (collision.gameObject.tag == "Platform"){
			Rooky.SetTrigger ("IsGrounded");
		}
	}
}
